// externals: ValidationErrorItem_0, stringifyValueWithType_0, isNaN_0, isArray_0, String_0, validateUnionWithErrorsRuntime_0, const_0, const_1, const_2, bound_has_0, const_3, const_4, validateDiscriminatedUnionWithErrors_0, const_5, const_6
'use strict';
return function(v0,v1){
var v2=(v1??{});
var v3=false;
if(v2.errors&&!("object"===typeof v0&&null!==v0)){
    v2.errors.push(new ValidationErrorItem_0("","type","Not an object",v0));
}
if("object"===typeof v0&&null!==v0){
    var v4=true;
    var v5=(v2.errors?v2.errors.length:0);
    if(v2.errors&&!("number"===typeof v0.id&&!(isNaN_0(v0.id)))){
        if(v5===v2.errors.length){
            if(v0.id===undefined){
                v2.errors.push(new ValidationErrorItem_0("id","type","Not a number",v0.id));
            }else{
                v2.errors.push(new ValidationErrorItem_0("id","type",("Cannot convert "+stringifyValueWithType_0(v0.id)+" to "+"number"),v0.id));
            }
        }
    }
    if(!("number"===typeof v0.id&&!(isNaN_0(v0.id)))){
        v4=false;
    }
    if(v2.errors&&!(isArray_0(v0.tags))){
        v2.errors.push(new ValidationErrorItem_0("tags","type","Not an array",v0.tags));
    }
    var v6=isArray_0(v0.tags);
    if(isArray_0(v0.tags)){
        for(var v8_arr=v0.tags,v8=0,v8_end=v8_arr.length;v8<v8_end;v8++){
            var v7=v8_arr[v8];
            var v9=false;
            if(v2.errors&&!("object"===typeof v7&&null!==v7)){
                v2.errors.push(new ValidationErrorItem_0(("tags"+"."+String_0(v8)),"type","Not an object",v7));
            }
            if("object"===typeof v7&&null!==v7){
                var v10=true;
                var v11=(v2.errors?v2.errors.length:0);
                if(v2.errors&&!("number"===typeof v7.id&&!(isNaN_0(v7.id)))){
                    if(v11===v2.errors.length){
                        if(v7.id===undefined){
                            v2.errors.push(new ValidationErrorItem_0(("tags"+"."+String_0(v8)+"."+"id"),"type","Not a number",v7.id));
                        }else{
                            v2.errors.push(new ValidationErrorItem_0(("tags"+"."+String_0(v8)+"."+"id"),"type",("Cannot convert "+stringifyValueWithType_0(v7.id)+" to "+"number"),v7.id));
                        }
                    }
                }
                if(!("number"===typeof v7.id&&!(isNaN_0(v7.id)))){
                    v10=false;
                }
                var v12=(v2.errors?v2.errors.length:0);
                if(v2.errors&&!("string"===typeof v7.label)){
                    if(v12===v2.errors.length){
                        v2.errors.push(new ValidationErrorItem_0(("tags"+"."+String_0(v8)+"."+"label"),"type","Not a string",v7.label));
                    }
                }
                if(!("string"===typeof v7.label)){
                    v10=false;
                }
                v9=v10;
            }
            if(!(v9)){
                v6=false;
            }
        }
    }
    if(!(v6)){
        v4=false;
    }
    var v13=false;
    if(v2.errors&&!("object"===typeof v0.meta&&null!==v0.meta)){
        v2.errors.push(new ValidationErrorItem_0("meta","type","Not an object",v0.meta));
    }
    if("object"===typeof v0.meta&&null!==v0.meta){
        var v14=true;
        v13=v14;
    }
    var v15=true;
    if(v13){
        for(var v16 in v0.meta){
            if(!(bound_has_0(v16))){
                if(v0.meta[v16]!==undefined){
                    if(!(validateUnionWithErrorsRuntime_0(v0.meta[v16],const_0,const_1,const_2,v2.errors,("meta"+"."+String_0(v16)),"string | number"))){
                        v15=false;
                    }
                }
            }
        }
        if(!(v15)){
            v13=false;
        }
    }
    if(!(v13)){
        v4=false;
    }
    if(!(validateUnionWithErrorsRuntime_0(v0.state,const_3,const_1,const_4,v2.errors,"state","'draft' | 'live' | 'gone'"))){
        v4=false;
    }
    var v17=false;
    if(null!=v0.shape&&"object"===typeof v0.shape){
        switch(v0.shape["kind"]){
            case "circle":{
                var v18=false;
                if(v2.errors&&!("object"===typeof v0.shape&&null!==v0.shape)){
                    v2.errors.push(new ValidationErrorItem_0("shape","type","Not an object",v0.shape));
                }
                if("object"===typeof v0.shape&&null!==v0.shape){
                    var v19=true;
                    if(!(v0.shape.kind==="circle")){
                        v19=false;
                    }
                    if(!("number"===typeof v0.shape.r&&!(isNaN_0(v0.shape.r)))){
                        v19=false;
                    }
                    v18=v19;
                }
                v17=v18;
            break;}
            case "rect":{
                var v20=false;
                if(v2.errors&&!("object"===typeof v0.shape&&null!==v0.shape)){
                    v2.errors.push(new ValidationErrorItem_0("shape","type","Not an object",v0.shape));
                }
                if("object"===typeof v0.shape&&null!==v0.shape){
                    var v21=true;
                    if(!(v0.shape.kind==="rect")){
                        v21=false;
                    }
                    if(!("number"===typeof v0.shape.w&&!(isNaN_0(v0.shape.w)))){
                        v21=false;
                    }
                    if(!("number"===typeof v0.shape.h&&!(isNaN_0(v0.shape.h)))){
                        v21=false;
                    }
                    v20=v21;
                }
                v17=v20;
            break;}
            default:{
                v17=false;
            break;}
        }
    }
    if(v2.errors&&!(v17)){
        validateDiscriminatedUnionWithErrors_0(v0.shape,"kind",const_5,const_1,const_6,v2.errors,"shape","Shape");
    }
    if(!(v17)){
        v4=false;
    }
    var v22=false;
    if(v2.errors&&!("object"===typeof v0.owner&&null!==v0.owner)){
        v2.errors.push(new ValidationErrorItem_0("owner","type","Not an object",v0.owner));
    }
    if("object"===typeof v0.owner&&null!==v0.owner){
        var v23=true;
        var v24=(v2.errors?v2.errors.length:0);
        if(v2.errors&&!("number"===typeof v0.owner.id&&!(isNaN_0(v0.owner.id)))){
            if(v24===v2.errors.length){
                if(v0.owner.id===undefined){
                    v2.errors.push(new ValidationErrorItem_0(("owner"+"."+"id"),"type","Not a number",v0.owner.id));
                }else{
                    v2.errors.push(new ValidationErrorItem_0(("owner"+"."+"id"),"type",("Cannot convert "+stringifyValueWithType_0(v0.owner.id)+" to "+"number"),v0.owner.id));
                }
            }
        }
        if(!("number"===typeof v0.owner.id&&!(isNaN_0(v0.owner.id)))){
            v23=false;
        }
        if(v2.errors&&!(isArray_0(v0.owner.names))){
            v2.errors.push(new ValidationErrorItem_0(("owner"+"."+"names"),"type","Not an array",v0.owner.names));
        }
        var v25=isArray_0(v0.owner.names);
        if(isArray_0(v0.owner.names)){
            for(var v27_arr=v0.owner.names,v27=0,v27_end=v27_arr.length;v27<v27_end;v27++){
                var v26=v27_arr[v27];
                var v28=(v2.errors?v2.errors.length:0);
                if(v2.errors&&!("string"===typeof v26)){
                    if(v28===v2.errors.length){
                        v2.errors.push(new ValidationErrorItem_0(("owner"+"."+"names"+"."+String_0(v27)),"type","Not a string",v26));
                    }
                }
                if(!("string"===typeof v26)){
                    v25=false;
                }
            }
        }
        if(!(v25)){
            v23=false;
        }
        v22=v23;
    }
    if(!(v22)){
        v4=false;
    }
    v3=v4;
}
return v3;
}

// externals: ValidationErrorItem_0
'use strict';
return function(v0,v1){
var v2=(v1??{});
var v3=(v2.errors?v2.errors.length:0);
if(v2.errors&&!("string"===typeof v0)){
    if(v3===v2.errors.length){
        v2.errors.push(new ValidationErrorItem_0("","type","Not a string",v0));
    }
}
return "string"===typeof v0;
}

// externals: ValidationErrorItem_0, stringifyValueWithType_0, isNaN_0
'use strict';
return function(v0,v1){
var v2=(v1??{});
var v3=(v2.errors?v2.errors.length:0);
if(v2.errors&&!("number"===typeof v0&&!(isNaN_0(v0)))){
    if(v3===v2.errors.length){
        if(v0===undefined){
            v2.errors.push(new ValidationErrorItem_0("","type","Not a number",v0));
        }else{
            v2.errors.push(new ValidationErrorItem_0("","type",("Cannot convert "+stringifyValueWithType_0(v0)+" to "+"number"),v0));
        }
    }
}
return "number"===typeof v0&&!(isNaN_0(v0));
}

// externals: ValidationErrorItem_0, stringifyValueWithType_0
'use strict';
return function(v0,v1){
var v2=(v1??{});
var v3=(v2.errors?v2.errors.length:0);
if(v2.errors&&!(v0==="draft")){
    if(v3===v2.errors.length){
        if(v0===undefined){
            v2.errors.push(new ValidationErrorItem_0("","type","Not a 'draft'",v0));
        }else{
            v2.errors.push(new ValidationErrorItem_0("","type",("Cannot convert "+stringifyValueWithType_0(v0)+" to "+"'draft'"),v0));
        }
    }
}
return v0==="draft";
}

// externals: ValidationErrorItem_0, stringifyValueWithType_0
'use strict';
return function(v0,v1){
var v2=(v1??{});
var v3=(v2.errors?v2.errors.length:0);
if(v2.errors&&!(v0==="live")){
    if(v3===v2.errors.length){
        if(v0===undefined){
            v2.errors.push(new ValidationErrorItem_0("","type","Not a 'live'",v0));
        }else{
            v2.errors.push(new ValidationErrorItem_0("","type",("Cannot convert "+stringifyValueWithType_0(v0)+" to "+"'live'"),v0));
        }
    }
}
return v0==="live";
}
