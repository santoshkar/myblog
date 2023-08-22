import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// Get some configuration values or set default values.
const config = new pulumi.Config();
const instanceTypeT2Micro = config.get("instanceType") || "t2.micro";
const vpcNetworkCidr = config.get("vpcNetworkCidr") || "10.0.0.0/16";
const ec2_instance_name: string = config.get("aws-ec2-name")|| "pulumi-v4";

// Look up the latest Amazon Linux 2 AMI.
const ami = aws.ec2.getAmi({
    filters: [{
        name: "name",
        values: ["ubuntu/images/hvm-ssd/ubuntu-*"],
    }],
    owners: ["amazon"],
    mostRecent: true,
}).then(invoke => invoke.id);



// Create VPC.
const vpc_name = ec2_instance_name+"-dmz-vpc";
const vpc = new aws.ec2.Vpc(vpc_name, {
    cidrBlock: vpcNetworkCidr,
    enableDnsHostnames: true,
    enableDnsSupport: true,
    instanceTenancy: "default", //Added newly
    tags: {
        Name: vpc_name
    }
});



// User data to start a HTTP server in the EC2 instance
const userDataMongo = `#!/bin/bash
    sudo apt-get update
    sudo apt-get install -y nodejs npm
    mkdir –p /home/ubuntu/workspace
    cd /home/ubuntu/workspace
    sudo git clone https://github.com/santoshkar/myblog.git
    cd myblog/
    sudo node hello_mongo.js
`;

// User data to start a HTTP server in the EC2 instance
const userData_NodeJs = `#!/bin/bash
    sudo apt-get update
    sudo apt-get install -y nodejs npm
    mkdir –p /home/ubuntu/workspace
    cd /home/ubuntu/workspace
    git clone https://github.com/santoshkar/myblog.git
    cd myblog/
    sudo node hello.js
`;


/*
    Subnets (public, private)
*/
const publicSubnet_1a_name = ec2_instance_name + "-dmz-public-subnet-1a";
const publicSubnet_1a = new aws.ec2.Subnet(publicSubnet_1a_name, {
    vpcId: vpc.id,
    cidrBlock: "10.0.0.0/24",      
    mapPublicIpOnLaunch: true,
    availabilityZone: "ap-south-1a",
    tags: {
        Name: publicSubnet_1a_name  
    }
});

const privateSubnet_1b_name = ec2_instance_name + "-dmz-public-subnet-1b";
const privateSubnet_1b = new aws.ec2.Subnet(privateSubnet_1b_name, {
    vpcId: vpc.id,
    cidrBlock: "10.0.1.0/24",      
    mapPublicIpOnLaunch: false,
    availabilityZone: "ap-south-1b",
    tags: {
        Name: privateSubnet_1b_name  
    }
});

// Create an internet gateway.
const gateway_name = ec2_instance_name+"-dmz-gateway";
const internetGateway = new aws.ec2.InternetGateway(gateway_name, {
    vpcId: vpc.id,
    tags: {
        Name: gateway_name,
        Description: "(Pulumi) Allows connection to VPC and EC2 Instance present in public Subnet"  //Newly Added  
    }
}
);

// Create a route table.
const publicRoutetable_name = ec2_instance_name+"-dmz-public-route-table";
const publicRoutetable = new aws.ec2.RouteTable(publicRoutetable_name, {
    vpcId: vpc.id,
    routes: [{
        cidrBlock: "0.0.0.0/0",   
        gatewayId: internetGateway.id,
    }],
    tags: {
        Name: publicRoutetable_name,
        description: "(Pulumi) Route Table for Inbound traffic to VPC"  //Added Newly  
    }
});

// Associate the route table with the public subnet.
const publicSubnetAssociationName  = ec2_instance_name+"-dmz-route-table-association";
const publicSubnetAssociation  = new aws.ec2.RouteTableAssociation(publicSubnetAssociationName, {
    subnetId: publicSubnet_1a.id,
    routeTableId: publicRoutetable.id,
});

const natGateway = new aws.ec2.NatGateway("nat-gateway", {
    subnetId: publicSubnet_1a.id,
    allocationId: "eipalloc-0fcaa5ac9c51c513f",
});

const privateRouteTable = new aws.ec2.RouteTable("private-route-table", {
    vpcId: vpc.id,
    routes: [{
        cidrBlock: "0.0.0.0/0",   
        // gatewayId: internetGateway.id,  //TODO: Check if it's needed
        natGatewayId: natGateway.id
    }],
    tags: {
        Name: "Private Route Table",
    },
});

const routetable_association_nodejs = ec2_instance_name+"-dmz-route-table-association_nodejs";
const routeTableAssociation_nodejs = new aws.ec2.RouteTableAssociation(routetable_association_nodejs, {
    subnetId: privateSubnet_1b.id,
    routeTableId: privateRouteTable.id,
});



// Create a security group allowing inbound access over port 80 and outbound
// access to anywhere.
//For MongoDB
const secGroup_name_private_mongo = ec2_instance_name+"-dmz-security-group-private";
const secGroupPrivate_mongo = new aws.ec2.SecurityGroup(secGroup_name_private_mongo, {
    name: secGroup_name_private_mongo,
    description: "Allows TCP, ICMP-IPv4, HTTP, SSH, to the webserver EC2 Instance",
    vpcId: vpc.id,
    ingress: [{
        description: "HTTP from VPC",
        fromPort: 80,
        toPort: 80,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"],
    },
    {
        description: "TLS from VPC",
        fromPort: 27017,
        toPort: 27017,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"],
    },
    {
        description: "ICMP from VPC",
        fromPort: -1,
        toPort: -1,
        protocol: "icmp",
        cidrBlocks: ["0.0.0.0/0"],
    },
    {
        description: "SSH from VPC",
        fromPort: 22,
        toPort: 22,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"],
    },
    {
        description: "HTTPS from VPC",
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
    tags: {
        Name: secGroup_name_private_mongo
    }
});


// 
// Create and launch an EC2 instance into the public subnet.
const ec2_mongo = ec2_instance_name+"-mongo";
const serverMongo = new aws.ec2.Instance(ec2_mongo, {
    instanceType: instanceTypeT2Micro,
    keyName: "Key",
    subnetId: privateSubnet_1b.id,
    vpcSecurityGroupIds: [secGroupPrivate_mongo.id],
    userData: userDataMongo,
    ami: ami,
    tags: {
        Name: ec2_mongo,
    },
});




/*
=================================================================
2nd Instance
=================================================================
*/

//For Public
const secGroup_name_nodejs = ec2_instance_name+"-dmz-security-group-nodejs";
const secGroup_Nodejs = new aws.ec2.SecurityGroup(secGroup_name_nodejs, {
    name: secGroup_name_nodejs,
    description: "Allows TCP, ICMP-IPv4, HTTP, SSH, to the webserver EC2 Instance",
    vpcId: vpc.id,
    ingress: [{
        description: "HTTP from VPC",
        fromPort: 80,
        toPort: 80,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"],
    },
    {
        description: "TLS from VPC",
        fromPort: 27017,
        toPort: 27017,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"],
    },
    {
        description: "ICMP from VPC",
        fromPort: -1,
        toPort: -1,
        protocol: "icmp",
        cidrBlocks: ["0.0.0.0/0"],
    },
    {
        description: "SSH from VPC",
        fromPort: 22,
        toPort: 22,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"],
    },
    {
        description: "HTTPS from VPC",
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
    }],
    tags: {
        Name: secGroup_name_nodejs
    }
});

const ec2_NodeJS = ec2_instance_name+"-nodejs";
const serverNodejs = new aws.ec2.Instance(ec2_NodeJS, {
    instanceType: instanceTypeT2Micro,
    subnetId: publicSubnet_1a.id,
    keyName: "Key",
    vpcSecurityGroupIds: [secGroup_Nodejs.id],
    userData: userData_NodeJs,
    ami: ami,
    tags: {
        Name: ec2_NodeJS,
    },
});

// Export the instance's publicly accessible IP address and hostname.
export const ip_serverNodejs = serverNodejs.publicIp;
export const hostname_serverNodejs = serverNodejs.publicDns;
export const url_serverNodejs = pulumi.interpolate`http://${serverNodejs.publicDns}`;
// Export the instance's publicly accessible IP address and hostname.
export const ip_serverMongo = serverMongo.publicIp;
export const host_serverMongo = serverMongo.publicDns;
export const url_serverMongo = pulumi.interpolate`http://${serverMongo.publicDns}`;
